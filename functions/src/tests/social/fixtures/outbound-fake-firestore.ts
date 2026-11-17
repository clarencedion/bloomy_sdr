/**
 * A small in-memory Firestore for the social outbound tests.
 *
 * It implements only what those services use — documents, subcollections,
 * equality / "in" queries, limit, create's ALREADY_EXISTS, transactions
 * with buffered writes and `FieldValue.delete()` — so the tests exercise the
 * real service code offline, with no emulator and no project.
 */

import { FieldValue } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
type Filter = { field: string; op: string; value: unknown };

function isPlainObject(value: unknown): value is Data {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  // Timestamps and Dates are immutable leaves for our purposes.
  return value;
}

/** `FieldValue.delete()`: removes the field, as Firestore does on update and merging set. */
function isDelete(value: unknown): boolean {
  return value instanceof FieldValue && value.isEqual(FieldValue.delete());
}

function deepMerge(target: Data, source: Data): Data {
  const out: Data = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isDelete(value)) {
      delete out[key];
      continue;
    }
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key] as Data, value) : clone(value);
  }
  return out;
}

function stripUndefined(data: Data): Data {
  return deepMerge({}, data);
}

function alreadyExists(path: string): Error {
  return Object.assign(new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`), { code: 6 });
}

export class FakeDocSnapshot {
  constructor(readonly ref: FakeDocRef, private readonly value: Data | undefined) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.value !== undefined;
  }
  data(): Data | undefined {
    return this.value === undefined ? undefined : clone(this.value);
  }
  get(field: string): unknown {
    return this.value?.[field];
  }
}

export class FakeDocRef {
  constructor(readonly db: FakeFirestore, readonly path: string) {}
  get id() {
    return this.path.split("/").pop() as string;
  }
  collection(name: string) {
    return new FakeQuery(this.db, `${this.path}/${name}`);
  }
  async get() {
    return new FakeDocSnapshot(this, this.db.store.get(this.path));
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.db.applySet(this.path, data, options);
  }
  async update(data: Data) {
    this.db.applyUpdate(this.path, data);
  }
  async create(data: Data) {
    this.db.applyCreate(this.path, data);
  }
  async delete() {
    this.db.store.delete(this.path);
  }
}

export class FakeQuery {
  constructor(
    readonly db: FakeFirestore,
    readonly path: string,
    private readonly filters: Filter[] = [],
    private readonly max?: number
  ) {}
  doc(id?: string) {
    return new FakeDocRef(this.db, `${this.path}/${id ?? this.db.nextId()}`);
  }
  async add(data: Data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, op, value }], this.max);
  }
  limit(n: number) {
    return new FakeQuery(this.db, this.path, this.filters, n);
  }
  async get() {
    const prefix = `${this.path}/`;
    const docs: FakeDocSnapshot[] = [];
    for (const [path, value] of this.db.store) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      if (!this.filters.every((f) => matches(value, f))) continue;
      docs.push(new FakeDocSnapshot(new FakeDocRef(this.db, path), value));
    }
    const limited = this.max === undefined ? docs : docs.slice(0, this.max);
    return {
      docs: limited,
      empty: limited.length === 0,
      size: limited.length,
      forEach: (cb: (doc: FakeDocSnapshot) => void) => limited.forEach(cb)
    };
  }
}

function matches(data: Data, filter: Filter): boolean {
  const actual = data[filter.field];
  switch (filter.op) {
    case "==":
      return actual === filter.value;
    case "in":
      return (filter.value as unknown[]).includes(actual);
    case "array-contains":
      return Array.isArray(actual) && actual.includes(filter.value);
    default:
      throw new Error(`Fake Firestore does not support operator ${filter.op}`);
  }
}

class FakeTransaction {
  private readonly writes: Array<() => void> = [];
  constructor(private readonly db: FakeFirestore) {}
  async get(target: FakeDocRef | FakeQuery) {
    if (this.writes.length) throw new Error("Transactions require all reads before any write.");
    return target.get();
  }
  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }) {
    this.writes.push(() => this.db.applySet(ref.path, data, options));
    return this;
  }
  update(ref: FakeDocRef, data: Data) {
    this.writes.push(() => this.db.applyUpdate(ref.path, data));
    return this;
  }
  create(ref: FakeDocRef, data: Data) {
    this.writes.push(() => this.db.applyCreate(ref.path, data));
    return this;
  }
  commit() {
    for (const write of this.writes) write();
  }
}

export class FakeFirestore {
  readonly store = new Map<string, Data>();
  private counter = 0;
  transactions = 0;

  nextId() {
    this.counter += 1;
    return `auto_${String(this.counter).padStart(4, "0")}`;
  }
  collection(name: string) {
    return new FakeQuery(this, name);
  }
  doc(path: string) {
    return new FakeDocRef(this, path);
  }
  async runTransaction<T>(fn: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const transaction = new FakeTransaction(this);
    const result = await fn(transaction);
    transaction.commit();
    return result;
  }

  applySet(path: string, data: Data, options?: { merge?: boolean }) {
    const current = this.store.get(path);
    this.store.set(path, options?.merge && current ? deepMerge(current, data) : stripUndefined(data));
  }
  applyUpdate(path: string, data: Data) {
    const current = this.store.get(path);
    if (!current) throw Object.assign(new Error(`5 NOT_FOUND: ${path}`), { code: 5 });
    const next: Data = { ...current };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (isDelete(value)) delete next[key];
      // Like Firestore, update replaces a map field as a whole.
      else next[key] = clone(value);
    }
    this.store.set(path, next);
  }
  applyCreate(path: string, data: Data) {
    if (this.store.has(path)) throw alreadyExists(path);
    this.store.set(path, stripUndefined(data));
  }

  // ── Test helpers ──
  reset() {
    this.store.clear();
    this.counter = 0;
    this.transactions = 0;
  }
  seed(path: string, data: Data) {
    this.store.set(path, stripUndefined(data));
  }
  read(path: string): Data | undefined {
    const value = this.store.get(path);
    return value === undefined ? undefined : clone(value);
  }
  /** Documents directly under a collection path, keyed by id. */
  list(collectionPath: string): Array<Data & { __id: string }> {
    const prefix = `${collectionPath}/`;
    return [...this.store.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({ ...clone(value), __id: path.slice(prefix.length) }));
  }
}

export const fakeDb = new FakeFirestore();
