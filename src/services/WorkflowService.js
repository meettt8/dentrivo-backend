import { WorkflowExecution, WorkflowRule } from '../models/index.js';
import notificationService from './NotificationService.js';

/**
 * WF-01 to WF-04: Workflow Automation Engine.
 * Processes event triggers, evaluates conditions, and executes actions.
 */
class WorkflowService {
  /** WF-01: Fire an event and process matching workflow rules. */
  async fireEvent(event, triggerable, triggerableType) {
    const rules = await WorkflowRule.find({
      trigger_event: event,
      is_active: 1,
    });

    for (const rule of rules) {
      // WF-02: Evaluate conditions
      if (!this.evaluateConditions(rule, triggerable)) continue;

      // WF-04: Schedule with delay or execute immediately
      // eslint-disable-next-line no-await-in-loop
      const execution = await WorkflowExecution.create({
        workflow_rule_id: rule.id,
        triggerable_type: triggerableType,
        triggerable_id: triggerable.id,
        status: rule.delay_minutes > 0 ? 'pending' : 'processing',
        scheduled_at: rule.delay_minutes > 0
          ? new Date(Date.now() + rule.delay_minutes * 60_000)
          : null,
      });

      if (rule.delay_minutes === 0) {
        // eslint-disable-next-line no-await-in-loop
        await this.executeAction(execution, rule);
      }
    }
  }

  /** Process pending delayed workflow executions (called by the scheduler). */
  async processDelayedExecutions() {
    const pending = await WorkflowExecution.find({
      status: 'pending',
      scheduled_at: { lte: new Date(), ne: null },
    });

    let processed = 0;
    for (const execution of pending) {
      // eslint-disable-next-line no-await-in-loop
      const rule = await WorkflowRule.findById(execution.workflow_rule_id);
      // eslint-disable-next-line no-await-in-loop
      await WorkflowExecution.update(execution.id, { status: 'processing' });
      // eslint-disable-next-line no-await-in-loop
      await this.executeAction(execution, rule);
      processed += 1;
    }

    return processed;
  }

  /** WF-02: Evaluate IFTTT conditions. */
  evaluateConditions(rule, triggerable) {
    const conditions = rule.conditions;
    if (!conditions || conditions.length === 0) return true;

    for (const condition of conditions) {
      const field = condition.field ?? null;
      const operator = condition.operator ?? '=';
      const value = condition.value ?? null;

      if (!field) continue;

      const actualValue = triggerable[field];

      let passes;
      switch (operator) {
        case '=': passes = actualValue == value; break;      // eslint-disable-line eqeqeq
        case '!=': passes = actualValue != value; break;     // eslint-disable-line eqeqeq
        case '>': passes = actualValue > value; break;
        case '<': passes = actualValue < value; break;
        case '>=': passes = actualValue >= value; break;
        case '<=': passes = actualValue <= value; break;
        case 'contains': passes = typeof actualValue === 'string' && actualValue.includes(value); break;
        case 'in': passes = Array.isArray(value) && value.includes(actualValue); break;
        default: passes = true;
      }

      if (!passes) return false;
    }

    return true;
  }

  /** WF-03: Execute the workflow action. */
  async executeAction(execution, rule) {
    try {
      const payload = rule?.action_payload ?? {};

      switch (rule?.action_type) {
        case 'send_sms':
          await this.sendNotification(execution, 'sms', payload);
          break;
        case 'send_email':
          await this.sendNotification(execution, 'email', payload);
          break;
        case 'send_whatsapp':
          await this.sendNotification(execution, 'whatsapp', payload);
          break;
        case 'alert_doctor':
          this.alertDoctor(execution, payload);
          break;
        case 'create_task':
          this.createTask(execution, payload);
          break;
        case 'webhook':
          this.fireWebhook(execution, payload);
          break;
        default:
          break;
      }

      await WorkflowExecution.update(execution.id, {
        status: 'completed',
        executed_at: new Date(),
        result: 'Action executed successfully',
      });
    } catch (error) {
      await WorkflowExecution.update(execution.id, {
        status: 'failed',
        executed_at: new Date(),
        result: `Error: ${error.message}`,
      });
      console.error('Workflow execution failed', {
        execution_id: execution.id,
        error: error.message,
      });
    }
  }

  async sendNotification(execution, channel, payload) {
    const recipient = payload.recipient ?? null;
    const message = payload.message ?? 'Automated notification from your clinic.';

    if (recipient) {
      await notificationService.send(
        'workflow_automation',
        channel,
        recipient,
        {},
        message,
      );
    }
  }

  alertDoctor(execution, payload) {
    console.log('Doctor alert triggered', {
      execution_id: execution.id,
      payload,
    });
  }

  createTask(execution, payload) {
    console.log('Task creation triggered', {
      execution_id: execution.id,
      payload,
    });
  }

  fireWebhook(execution, payload) {
    console.log('Webhook fire triggered', {
      execution_id: execution.id,
      url: payload.url ?? 'not specified',
    });
  }
}

export default new WorkflowService();
