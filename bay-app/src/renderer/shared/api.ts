export async function apiRequest<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  return window.bayApp.apiRequest(method, path, body);
}
