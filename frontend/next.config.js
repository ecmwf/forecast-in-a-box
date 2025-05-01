/** @type {import('next').NextConfig} */
const nextConfig = {
  // rewrites: async () => {
  //   return [
  //     // {
  //     //   source: "/:path*",
  //     //   destination:
  //     //     process.env.NODE_ENV === "development"
  //     //       ? "http://127.0.0.1:8000/:path*"
  //     //       : `${process.env.NEXT_PUBLIC_API_URL}/:path*`,
  //     // },
  //     {
  //       source: "/docs",
  //       destination:
  //         process.env.NODE_ENV === "development"
  //           ? "http://127.0.0.1:8000/docs"
  //           : `${process.env.NEXT_PUBLIC_API_URL}/docs`,
  //     },
  //     {
  //       source: "/openapi.json",
  //       destination:
  //         process.env.NODE_ENV === "development"
  //         ? "http://127.0.0.1:8000/openapi.json"
  //         : `${process.env.NEXT_PUBLIC_API_URL}/openapi.json`,
  //     },
  //   ];
  // },
};
nextConfig.typescript = {
  ignoreBuildErrors: true,
};
module.exports = nextConfig;
