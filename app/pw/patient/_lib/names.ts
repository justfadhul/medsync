/** "MIREMBE JOSELYN NAYIGA" reads as "Mirembe Joselyn Nayiga"; a name typed in mixed case is left alone. */
export const shownName = (n: string) =>
  n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : n;
