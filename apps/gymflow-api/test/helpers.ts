// Partial dependency mocks cross an explicit typed boundary; data and calls stay typed.
export function dependency<T>(value: unknown): T {
	return value as T;
}
export function query<T>(value: T) {
	const result = {
		exec: jest.fn<Promise<T>, []>(() => Promise.resolve(value)),
		lean: () => result,
		select: () => result,
	};
	return result;
}
