import { getDb } from '../config/db.js';
import { parseSort, toIdQuery } from './Table.js';

/**
 * Escape a user-supplied search term for RegExp.
 */
export function likeTerm(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Paginate a MongoDB collection directly.
 */
export async function paginate({
  from,
  collection: collectionName,
  where = {},
  filter = {},
  page = 1,
  perPage = 15,
  orderBy = { created_at: -1, _id: -1 },
}) {
  const targetCollection = collectionName || from;
  const col = typeof targetCollection === 'string'
    ? getDb().collection(targetCollection.replace(/[`'"]/g, '').trim())
    : targetCollection;

  const currentPage = Math.max(1, Number(page) || 1);
  const limit = Number(perPage || 15);
  const query = { ...where, ...filter };

  const total = await col.countDocuments(query);
  const sort = parseSort(orderBy);

  const docs = await col
    .find(query)
    .sort(sort)
    .skip((currentPage - 1) * limit)
    .limit(limit)
    .toArray();

  const data = docs.map((doc) => {
    const item = { ...doc };
    if (item._id) item.id = String(item._id);
    return item;
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

/**
 * Helper to run a transaction with MongoDB session if replica set is available.
 */
export async function transaction(work) {
  const session = getDb().client.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}
