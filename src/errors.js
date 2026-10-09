export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(condition, message, status = 422) {
  if (!condition) throw new ApiError(status, message);
}
