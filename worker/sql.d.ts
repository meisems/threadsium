// SQL migration files are bundled as text (wrangler.jsonc "rules": Text for **/*.sql).
declare module "*.sql" {
  const text: string;
  export default text;
}
