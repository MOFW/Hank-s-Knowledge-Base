import { searchInput, searchParameters } from "@/domain/search";
import { api, result } from "@/lib/http";
import { searchLibrary } from "@/services/search";

export const GET = api(async (request, { ownerId, requestId }) => {
  const input = searchInput.parse(searchParameters(new URL(request.url).searchParams));
  return result(await searchLibrary(ownerId, input), requestId);
});
