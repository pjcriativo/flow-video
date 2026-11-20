/**
 * The shape of a Portuguese dictionary: the same as the English module, with every string free
 * to change and every key optional, so a missing word simply stays in English.
 */
export type Words<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Words<R>
    : T extends readonly (infer U)[]
      ? Words<U>[]
      : T extends object
        ? { [K in keyof T]?: Words<T[K]> }
        : T;
