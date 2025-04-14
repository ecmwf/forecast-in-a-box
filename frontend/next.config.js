/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/:path*"
            : `${process.env.NEXT_PUBLIC_API_URL}/api/py/:path*`,
      },
      {
        source: "/docs",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/docs"
            : `${process.env.NEXT_PUBLIC_API_URL}/api/py/docs`,
      },
      {
        source: "/openapi.json",
        destination:
          process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:8000/api/py/openapi.json"
          : `${process.env.NEXT_PUBLIC_API_URL}/api/py/openapi.json`,
      },
    ];
  },
};
nextConfig.typescript = {
  ignoreBuildErrors: true,
};
module.exports = nextConfig;
