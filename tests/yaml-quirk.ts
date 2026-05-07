import { parse } from "yaml";

const cases: Array<[string, string]> = [
  [
    "pure ascii line continuation",
    'foo: "abc\\\n  def"',
  ],
  [
    "at column 99 like Ellucian",
    'foo: "#/components/schemas/schema-admission-application-supporting-item-types.\\\n  json"',
  ],
  [
    "exact snippet from failing file",
    [
      "paths:",
      "  /resource:",
      "    get:",
      "      responses:",
      "        '200':",
      "          content:",
      "            application/json:",
      "              schema:",
      "                type: array",
      "                items:",
      `                  $ref: "#/components/schemas/schema-admission-application-supporting-item-types.\\`,
      `                  json"`,
    ].join("\n"),
  ],
];

for (const [name, src] of cases) {
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(src));
  try {
    const parsed = parse(src);
    console.log("parsed:", JSON.stringify(parsed));
  } catch (err) {
    console.log("ERROR:", (err as Error).message.split("\n")[0]);
  }
}
