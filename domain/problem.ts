export class Problem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: unknown,
  ) {
    super(message);
  }
}
