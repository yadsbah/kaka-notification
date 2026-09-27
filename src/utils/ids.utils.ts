// UUIDv7 is time-ordered like a ULID, and built into Bun.
export const newID = (prefix: "prj" | "ntf" | "job" | "wrk") =>
  `${prefix}_${Bun.randomUUIDv7().replaceAll("-", "")}`;
