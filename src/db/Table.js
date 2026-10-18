import mongoose from 'mongoose';
import { getDb } from '../config/db.js';

/**
 * Check if a value is a valid 24-character hex ObjectId string or ObjectId instance.
 */
export function toObjectId(val) {
  if (!val) return null;
  if (val instanceof mongoose.Types.ObjectId) return val;
  if (typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val)) {
    try {
      return new mongoose.Types.ObjectId(val);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build a query matching an ID across _id (ObjectId or string) and id field.
 */
export function toIdQuery(id) {
  if (id === undefined || id === null) return { _id: null };
  const oid = toObjectId(id);
  const conditions = [{ _id: id }, { id: String(id) }];
  if (oid) conditions.unshift({ _id: oid });
  const num = Number(id);
  if (!Number.isNaN(num)) conditions.push({ id: num });
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

/**
 * Convert string sort expressions like "created_at DESC, id DESC" or "`id` ASC"
 * into MongoDB sort objects like { created_at: -1, _id: -1 }.
 */
export function parseSort(orderBy) {
  if (!orderBy) return { created_at: -1, _id: -1 };
  if (typeof orderBy === 'object' && !Array.isArray(orderBy)) return orderBy;

  const sort = {};
  const parts = String(orderBy).split(',');

  for (const part of parts) {
    const trimmed = part.trim().replace(/`/g, '');
    if (!trimmed) continue;
    const [field, direction = 'ASC'] = trimmed.split(/\s+/);
    const key = field === 'id' ? '_id' : field;
    sort[key] = direction.toUpperCase() === 'DESC' ? -1 : 1;
  }

  return sort;
}

/**
 * Escape string for RegExp search.
 */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * MongoDB repository providing identical API methods for controllers and models.
 */
export default class Table {
  constructor(name, {
    softDeletes = false,
    hidden = [],
    casts = {},
    timestamps = true,
    appends = null,
  } = {}) {
    this.name = name;
    this.softDeletes = softDeletes;
    this.hidden = hidden;
    this.casts = casts;
    this.timestamps = timestamps;
    this.appends = appends;
  }

  get collection() {
    return getDb().collection(this.name);
  }

  /**
   * Convert filter object into MongoDB query shape.
   */
  normalizeFilter(filter = {}, withTrashed = false) {
    if (!filter || typeof filter !== 'object') return {};

    const query = {};
    const andClauses = [];

    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;

      if (key === '$or' || key === 'or') {
        const branches = Array.isArray(value) ? value : [value];
        const normalizedBranches = branches
          .map((b) => this.normalizeFilter(b, true))
          .filter((b) => Object.keys(b).length > 0);
        if (normalizedBranches.length > 0) {
          andClauses.push({ $or: normalizedBranches });
        }
        continue;
      }

      if (key === '$and' || key === 'and') {
        const branches = Array.isArray(value) ? value : [value];
        for (const branch of branches) {
          const norm = this.normalizeFilter(branch, true);
          if (Object.keys(norm).length > 0) andClauses.push(norm);
        }
        continue;
      }

      if (key === 'id') {
        if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
          if (value.in || value.$in) {
            const list = Array.isArray(value.in || value.$in) ? (value.in || value.$in) : [value.in || value.$in];
            if (list.length === 0) {
              andClauses.push({ _id: '__none__' });
            } else {
              const idConditions = list.flatMap((item) => {
                const oid = toObjectId(item);
                const itemStr = String(item);
                return oid ? [{ _id: oid }, { _id: itemStr }, { id: itemStr }] : [{ _id: itemStr }, { id: itemStr }];
              });
              andClauses.push({ $or: idConditions });
            }
            continue;
          }
          if (value.ne || value.$ne) {
            const target = value.ne || value.$ne;
            const oid = toObjectId(target);
            const targetStr = String(target);
            const neConditions = [{ _id: { $ne: targetStr } }, { id: { $ne: targetStr } }];
            if (oid) neConditions.push({ _id: { $ne: oid } });
            andClauses.push({ $and: neConditions });
            continue;
          }
        }
        andClauses.push(toIdQuery(value));
        continue;
      }

      if (key === 'is_active' || this.casts[key] === 'boolean') {
        if (value === 1 || value === true || value === '1' || value === 'true') {
          query[key] = { $in: [true, 1, '1', 'true'] };
          continue;
        }
        if (value === 0 || value === false || value === '0' || value === 'false') {
          query[key] = { $in: [false, 0, '0', 'false'] };
          continue;
        }
      }

      if (key.endsWith('_id') && typeof value === 'string') {
        const oid = toObjectId(value);
        if (oid) {
          query[key] = { $in: [oid, String(value)] };
          continue;
        }
      }

      if (value === null) {
        query[key] = null;
        continue;
      }

      if (value instanceof Date || value instanceof RegExp || Array.isArray(value) || value instanceof mongoose.Types.ObjectId) {
        query[key] = value;
        continue;
      }

      if (typeof value === 'object') {
        const fieldQuery = {};
        for (const [op, opVal] of Object.entries(value)) {
          switch (op) {
            case 'ne':
            case '$ne':
              fieldQuery.$ne = opVal;
              break;
            case 'in':
            case '$in': {
              const list = Array.isArray(opVal) ? opVal : [opVal];
              if (key.endsWith('_id')) {
                fieldQuery.$in = list.flatMap((item) => {
                  const oid = toObjectId(item);
                  return oid ? [oid, String(item)] : [item];
                });
              } else {
                fieldQuery.$in = list;
              }
              break;
            }
            case 'notIn':
            case '$nin':
              fieldQuery.$nin = Array.isArray(opVal) ? opVal : [opVal];
              break;
            case 'gt':
            case '$gt':
              fieldQuery.$gt = opVal;
              break;
            case 'gte':
            case '$gte':
              fieldQuery.$gte = opVal;
              break;
            case 'lt':
            case '$lt':
              fieldQuery.$lt = opVal;
              break;
            case 'lte':
            case '$lte':
              fieldQuery.$lte = opVal;
              break;
            case 'like':
            case '$regex': {
              const pattern = String(opVal).replace(/^%/, '').replace(/%$/, '');
              fieldQuery.$regex = new RegExp(escapeRegex(pattern), 'i');
              break;
            }
            case 'between':
              if (Array.isArray(opVal) && opVal.length >= 2) {
                fieldQuery.$gte = opVal[0];
                fieldQuery.$lte = opVal[1];
              }
              break;
            default:
              if (op.startsWith('$')) {
                fieldQuery[op] = opVal;
              }
              break;
          }
        }
        if (Object.keys(fieldQuery).length > 0) {
          query[key] = fieldQuery;
        }
        continue;
      }

      query[key] = value;
    }

    if (this.softDeletes && !withTrashed) {
      query.deleted_at = null;
    }

    if (andClauses.length > 0) {
      if (Object.keys(query).length > 0) {
        andClauses.push(query);
      }
      return { $and: andClauses };
    }

    return query;
  }

  /**
   * Normalise a document: map _id to id, cast columns, drop hidden ones, add computed fields.
   */
  present(doc, { keepHidden = [] } = {}) {
    if (!doc) return null;
    const out = { ...doc };

    // Standardize id property
    if (out._id !== undefined && out._id !== null) {
      out.id = out.id !== undefined && out.id !== null ? out.id : String(out._id);
      out._id = String(out._id);
    }

    for (const [column, type] of Object.entries(this.casts)) {
      if (out[column] === undefined || out[column] === null) {
        if (type === 'boolean' && (column === 'is_active' || column.startsWith('has_'))) {
          out[column] = false;
        }
        continue;
      }
      if (type === 'boolean') out[column] = Boolean(out[column] === true || out[column] === 1 || out[column] === '1');
      else if (type === 'number') out[column] = Number(out[column]);
      else if (type === 'json' && typeof out[column] === 'string') {
        try { out[column] = JSON.parse(out[column]); } catch { /* leave as-is */ }
      }
    }

    for (const column of this.hidden) {
      if (!keepHidden.includes(column)) delete out[column];
    }

    if (this.appends) Object.assign(out, this.appends(out));
    return out;
  }

  presentAll(rows, options) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => this.present(row, options));
  }

  async find(filter = {}, {
    orderBy = null, limit = null, offset = null, withTrashed = false, keepHidden = [],
  } = {}) {
    const query = this.normalizeFilter(filter, withTrashed);
    let cursor = this.collection.find(query);

    if (orderBy) cursor = cursor.sort(parseSort(orderBy));
    if (offset !== null && offset > 0) cursor = cursor.skip(Number(offset));
    if (limit !== null && limit > 0) cursor = cursor.limit(Number(limit));

    const docs = await cursor.toArray();
    return this.presentAll(docs, { keepHidden });
  }

  async findOne(filter = {}, options = {}) {
    const rows = await this.find(filter, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async findById(value, options = {}) {
    if (value === undefined || value === null || value === '') return null;
    return this.findOne({ id: value }, options);
  }

  async count(filter = {}, { withTrashed = false } = {}) {
    const query = this.normalizeFilter(filter, withTrashed);
    return this.collection.countDocuments(query);
  }

  async exists(filter = {}, options = {}) {
    return (await this.count(filter, options)) > 0;
  }

  async sum(column, filter = {}, { withTrashed = false } = {}) {
    const query = this.normalizeFilter(filter, withTrashed);
    const pipeline = [
      { $match: query },
      { $group: { _id: null, total: { $sum: `$${column}` } } },
    ];
    const results = await this.collection.aggregate(pipeline).toArray();
    return Number(results[0]?.total ?? 0);
  }

  async distinct(column, filter = {}, { withTrashed = false } = {}) {
    const query = this.normalizeFilter(filter, withTrashed);
    const values = await this.collection.distinct(column, query);
    return values.filter((v) => v !== null && v !== undefined).map((v) => (typeof v === 'object' && v !== null && v._bsontype ? String(v) : v));
  }

  async create(data) {
    const payload = this.withTimestamps(data, { creating: true });
    if (!payload._id) {
      payload._id = new mongoose.Types.ObjectId();
    }
    payload.id = String(payload._id);

    await this.collection.insertOne(payload);
    return this.findById(payload._id);
  }

  async createMany(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const payloads = rows.map((row) => {
      const p = this.withTimestamps(row, { creating: true });
      if (!p._id) p._id = new mongoose.Types.ObjectId();
      p.id = String(p._id);
      return p;
    });

    await this.collection.insertMany(payloads);
    return payloads.map((p) => this.present(p));
  }

  async update(rowId, data) {
    if (!rowId) return null;
    const payload = this.withTimestamps(data, { creating: false });
    delete payload.id;
    delete payload._id;

    if (Object.keys(payload).length > 0) {
      await this.collection.updateOne(toIdQuery(rowId), { $set: payload });
    }
    return this.findById(rowId);
  }

  async updateWhere(filter, data) {
    const payload = this.withTimestamps(data, { creating: false });
    delete payload.id;
    delete payload._id;
    if (Object.keys(payload).length === 0) return 0;

    const query = this.normalizeFilter(filter, false);
    const result = await this.collection.updateMany(query, { $set: payload });
    return result.modifiedCount;
  }

  async delete(rowId) {
    if (!rowId) return false;
    if (this.softDeletes) {
      await this.collection.updateOne(toIdQuery(rowId), {
        $set: { deleted_at: new Date() },
      });
      return true;
    }
    await this.collection.deleteOne(toIdQuery(rowId));
    return true;
  }

  async forceDelete(rowId) {
    if (!rowId) return false;
    await this.collection.deleteOne(toIdQuery(rowId));
    return true;
  }

  async updateOrCreate(filter, data) {
    const existing = await this.findOne(filter);
    if (existing) return this.update(existing.id, data);
    return this.create({ ...filter, ...data });
  }

  async firstOrCreate(filter, data = {}) {
    const existing = await this.findOne(filter);
    if (existing) return existing;
    return this.create({ ...filter, ...data });
  }

  async paginate(options = {}) {
    const currentPage = Math.max(1, Number(options.page) || 1);
    const limit = Number(options.perPage || 15);
    const filter = options.filter || options.where || {};
    const withTrashed = Boolean(options.withTrashed);
    const orderBy = options.orderBy || '`created_at` DESC, `id` DESC';
    const keepHidden = options.keepHidden || [];

    const total = await this.count(filter, { withTrashed });
    const data = await this.find(filter, {
      orderBy,
      limit,
      offset: (currentPage - 1) * limit,
      withTrashed,
      keepHidden,
    });

    const lastPage = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      current_page: currentPage,
      last_page: lastPage,
      per_page: limit,
      total,
      from: total === 0 ? null : (currentPage - 1) * limit + 1,
      to: total === 0 ? null : Math.min(currentPage * limit, total),
    };
  }

  withTimestamps(data, { creating }) {
    if (!this.timestamps) return { ...data };
    const now = new Date();
    const result = creating
      ? { ...data, created_at: data.created_at ?? now, updated_at: data.updated_at ?? now }
      : { ...data, updated_at: now };

    if (creating && this.casts.is_active === 'boolean' && result.is_active === undefined) {
      result.is_active = true;
    }

    return result;
  }
}
