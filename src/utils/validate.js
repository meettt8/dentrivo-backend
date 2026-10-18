import { ValidationError } from './http.js';

/**
 * A compact port of Laravel's `$request->validate()`. Supports the rule set the
 * PHP controllers actually used:
 *
 *   required | nullable | string | email | numeric | integer | boolean | date
 *   min:n | max:n | in:a,b,c | confirmed
 *   after:field | after_or_equal:today | after_or_equal:date
 *   unique:Model,field[,exceptId] | exists:Model,field
 *
 * `unique` and `exists` hit the database, so this is async.
 */

const HUMAN = (field) => field.replace(/_/g, ' ');

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function applyRule(rule, field, value, data, models, ruleList) {
  const [name, argString] = rule.split(':');
  const args = argString ? argString.split(',') : [];
  // Laravel sizes numerics by value and everything else by length.
  const isNumericField = ruleList.includes('numeric') || ruleList.includes('integer');

  switch (name) {
    case 'required':
      if (isEmpty(value)) return `The ${HUMAN(field)} field is required.`;
      return null;

    case 'nullable':
    case 'sometimes':
      return null;

    case 'string':
      if (!isEmpty(value) && typeof value !== 'string') return `The ${HUMAN(field)} must be a string.`;
      return null;

    case 'email':
      if (!isEmpty(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        return `The ${HUMAN(field)} must be a valid email address.`;
      }
      return null;

    case 'numeric':
      if (!isEmpty(value) && Number.isNaN(Number(value))) return `The ${HUMAN(field)} must be a number.`;
      return null;

    case 'integer':
      if (!isEmpty(value) && !Number.isInteger(Number(value))) return `The ${HUMAN(field)} must be an integer.`;
      return null;

    case 'boolean':
      if (!isEmpty(value) && !['0', '1', 'true', 'false', true, false, 0, 1].includes(value)) {
        return `The ${HUMAN(field)} field must be true or false.`;
      }
      return null;

    case 'date':
      if (!isEmpty(value) && Number.isNaN(Date.parse(value))) return `The ${HUMAN(field)} is not a valid date.`;
      return null;

    case 'file':
      return null;   // multer has already validated presence upstream

    case 'min': {
      if (isEmpty(value)) return null;
      const limit = Number(args[0]);
      if (isNumericField) {
        return Number(value) < limit ? `The ${HUMAN(field)} must be at least ${limit}.` : null;
      }
      return String(value).length < limit
        ? `The ${HUMAN(field)} must be at least ${limit} characters.`
        : null;
    }

    case 'max': {
      if (isEmpty(value)) return null;
      const limit = Number(args[0]);
      if (isNumericField) {
        return Number(value) > limit ? `The ${HUMAN(field)} may not be greater than ${limit}.` : null;
      }
      return String(value).length > limit
        ? `The ${HUMAN(field)} may not be greater than ${limit} characters.`
        : null;
    }

    case 'in':
      if (!isEmpty(value) && !args.includes(String(value))) {
        return `The selected ${HUMAN(field)} is invalid.`;
      }
      return null;

    case 'confirmed':
      if (value !== data[`${field}_confirmation`]) {
        return `The ${HUMAN(field)} confirmation does not match.`;
      }
      return null;

    case 'after': {
      if (isEmpty(value)) return null;
      const other = data[args[0]];
      if (isEmpty(other)) return null;
      // Times ('10:00') compare lexicographically; dates go through Date.parse.
      const isTime = /^\d{1,2}:\d{2}/.test(String(value));
      const passes = isTime
        ? String(value) > String(other)
        : new Date(value) > new Date(other);
      return passes ? null : `The ${HUMAN(field)} must be after ${HUMAN(args[0])}.`;
    }

    case 'after_or_equal': {
      if (isEmpty(value)) return null;
      const target = args[0] === 'today' ? startOfToday() : new Date(data[args[0]] ?? args[0]);
      const given = new Date(value);
      given.setHours(0, 0, 0, 0);
      return given >= target
        ? null
        : `The ${HUMAN(field)} must be a date after or equal to ${args[0]}.`;
    }

    case 'unique': {
      if (isEmpty(value)) return null;
      const [modelName, column = field, exceptId] = args;
      const Model = models[modelName];
      if (!Model) return null;
      const existing = await Model.findOne({ [column]: value }, { withTrashed: true });
      if (existing && String(existing.id) !== String(exceptId ?? '')) {
        return `The ${HUMAN(field)} has already been taken.`;
      }
      return null;
    }

    case 'exists': {
      if (isEmpty(value)) return null;
      const [modelName, column = 'id'] = args;
      const Model = models[modelName];
      if (!Model) return null;
      const found = await Model.exists({ [column]: value }).catch(() => false);
      return found ? null : `The selected ${HUMAN(field)} is invalid.`;
    }

    default:
      return null;
  }
}

/**
 * @param {object} data   request body
 * @param {object} rules  { field: 'required|email|unique:Patient,email' }
 * @param {object} models model registry for unique/exists lookups
 * @returns {Promise<object>} the validated subset of `data`
 */
export async function validate(data, rules, models = {}) {
  const errors = {};

  for (const [field, ruleString] of Object.entries(rules)) {
    const ruleList = Array.isArray(ruleString) ? ruleString : ruleString.split('|');
    const value = data[field];

    // `nullable` short-circuits every other rule when the value is absent.
    if (ruleList.includes('nullable') && isEmpty(value)) continue;

    for (const rule of ruleList) {
      // eslint-disable-next-line no-await-in-loop
      const message = await applyRule(rule, field, value, data, models, ruleList);
      if (message) {
        errors[field] = [message];
        break;   // one message per field, as Laravel does by default
      }
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const validated = {};
  for (const field of Object.keys(rules)) {
    if (data[field] !== undefined) validated[field] = data[field];
  }
  return validated;
}

export default validate;
