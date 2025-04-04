/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8001/api/py/:path*"
            : `https://${process.env.API_URL}/api/py/:path*`,
      },
      {
        source: "/docs",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/docs"
            : `https://${process.env.API_URL}/api/py/docs`,
      },
      {
        source: "/openapi.json",
        destination:
          process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:8000/api/py/openapi.json"
          : `https://${process.env.API_URL}/api/py/openapi.json`,
      },
    ];
  },
};

module.exports = nextConfig;
