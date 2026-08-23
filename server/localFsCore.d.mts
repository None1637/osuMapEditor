export declare function createLocalFsHandler(
  getDirs: () => { songs: string | null; skin: string | null }
): (
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body?: Buffer
) => null | { status: number; contentType: string; body: Buffer | string };
