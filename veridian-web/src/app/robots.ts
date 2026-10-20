import type { MetadataRoute } from "next";

// Public catalog routes only: the curation workspace is intentionally excluded.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/"],
    },
  };
}
