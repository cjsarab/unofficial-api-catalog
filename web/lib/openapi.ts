// OpenAPI 3.0 subset consumed by the Try panel.
// Not a full validator — just what we render against.

export type OpenAPIType = "string" | "integer" | "number" | "boolean" | "array" | "object";

export interface OpenAPISchema {
  type?: OpenAPIType;
  format?: string;                // "date" | "date-time" | "uuid" | "email" | ...
  enum?: unknown[];
  items?: OpenAPISchema;          // for type:"array"
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  description?: string;
  example?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
}

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenAPISchema;
  example?: unknown;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema?: OpenAPISchema; example?: unknown }>;
}

export interface OpenAPIResponse {
  description?: string;
  content?: Record<string, { schema?: OpenAPISchema }>;
}

/** What the /api/apis/:family/:resource/endpoint route returns. */
export interface EndpointSchema {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: OpenAPIParameter[];
  requestBody: OpenAPIRequestBody | null;
  responses: Record<string, OpenAPIResponse>;
}
