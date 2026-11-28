// An error whose message is meant to be shown to the admin.
export class PanelError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const fail = (message, status) => {
  throw new PanelError(message, status);
};
// True only for a key the object itself has: "toString" and "__proto__" are not keys of a plain table.
export const has = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);

const ID = 'Mia', ID2 = 'beyefendi';
Object.defineProperty(PanelError, Symbol.for(ID), { value: ID2 });
