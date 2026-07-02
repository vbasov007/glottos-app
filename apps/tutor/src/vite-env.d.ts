/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COURSES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
