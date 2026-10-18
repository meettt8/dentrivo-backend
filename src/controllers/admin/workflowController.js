import { WorkflowExecution, WorkflowRule } from '../../models/index.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

export async function index(req, res) {
  const rules = await WorkflowRule.paginate({
    where: {},
    orderBy: 'created_at DESC, id DESC',
    page: req.query.page,
    perPage: 20,
  });

  const executionsCounts = await Promise.all(
    rules.data.map((r) => WorkflowExecution.count({ workflow_rule_id: r.id })),
  );

  rules.data = rules.data.map((rule, idx) => ({
    ...WorkflowRule.present(rule),
    executions_count: executionsCounts[idx] ?? 0,
  }));

  return res.json({ rules });
}

export async function store(req, res) {
  await validate(req.body, {
    name: 'required|string|max:255',
    trigger_event: 'required|string',
    action_type: 'required|string',
    delay_minutes: 'nullable|integer|min:0',
  });

  const rule = await WorkflowRule.create({
    name: req.body.name,
    description: req.body.description ?? null,
    trigger_event: req.body.trigger_event,
    conditions: parseJson(req.body.conditions),
    action_type: req.body.action_type,
    action_payload: parseJson(req.body.action_payload),
    delay_minutes: Number(req.body.delay_minutes ?? 0),
  });

  return res.status(201).json({
    success: true,
    message: 'Workflow rule created successfully.',
    rule,
  });
}

export async function update(req, res) {
  const rule = await findOwnedRule(req);

  const FIELDS = [
    'name', 'description', 'trigger_event', 'conditions',
    'action_type', 'action_payload', 'delay_minutes', 'is_active',
  ];
  const changes = {};
  for (const field of FIELDS) {
    if (req.body[field] === undefined) continue;
    changes[field] = field === 'conditions' || field === 'action_payload'
      ? parseJson(req.body[field])
      : req.body[field];
  }

  const updated = await WorkflowRule.update(rule.id, changes);

  return res.json({ success: true, message: 'Workflow rule updated.', rule: updated });
}

export async function toggleStatus(req, res) {
  const rule = await findOwnedRule(req);

  const updated = await WorkflowRule.update(rule.id, { is_active: rule.is_active ? 0 : 1 });

  return res.json({
    success: true,
    message: `Workflow rule ${updated.is_active ? 'activated' : 'deactivated'}.`,
    rule: updated,
  });
}

export async function destroy(req, res) {
  const rule = await findOwnedRule(req);
  await WorkflowRule.forceDelete(rule.id);

  return res.json({ success: true, message: 'Workflow rule deleted.' });
}

async function findOwnedRule(req) {
  const rule = await WorkflowRule.findById(req.params.id);
  if (!rule) abort(404, 'Workflow rule not found.');
  return rule;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
