export async function analysisApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Analysis API unavailable. Start the backend on port 3001 and retry.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
