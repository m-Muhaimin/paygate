import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal merchant admin app — no need for cacheComponents/partialPrefetching,
  // both are experimental and fight client-side hooks (Date.now, useParams) at prerender.
};

export default nextConfig;
