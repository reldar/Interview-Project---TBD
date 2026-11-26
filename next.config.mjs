const PDF_WORKER_FILES = [
  './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
];

export default {
  poweredByHeader: false,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingIncludes: {
    '/api/analyze-cv': PDF_WORKER_FILES,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
