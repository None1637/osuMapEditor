export declare function createLocalFsHandler(
  getDirs: () => { songs: string | null; skin: string | null }
): (
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body?: Buffer
) => Promise<null | { status: number; contentType: string; body: Buffer | string; headers?: Record<string, string> }>; // v450: headers 附加响应头 (X-File-Mtime)
