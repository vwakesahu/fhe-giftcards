// Compat shim: links live in constants now. Re-export so existing
// imports keep working. Prefer importing from "@/lib/constants" for
// new code.
export { GITHUB_URL, APP_URL, BASESCAN } from "./constants";
