export interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: {
    title?: string;
    version?: string;
    description?: string;
    contact?: Record<string, string>;
    license?: { name: string; url?: string };
  };
  paths: Record<string, Record<string, any>>;
  components?: { schemas?: Record<string, any> };
  definitions?: Record<string, any>;
  servers?: { url: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  consumes?: string[];
  produces?: string[];
}

export interface EndpointSummary {
  path: string;
  method: string;
  summary: string;
  operationId?: string;
  tags: string[];
  deprecated: boolean;
}

export interface SchemaSummary {
  name: string;
  type: string;
  description?: string;
  properties: number;
}

export interface SearchResult {
  type: "endpoint" | "schema" | "property";
  path?: string;
  method?: string;
  schemaName?: string;
  propertyName?: string;
  match: string;
  summary?: string;
}

export interface FormattedEndpoint {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  deprecated: boolean;
  parameters?: any[];
  requestBody?: any;
  responses?: any;
  security?: any[];
}
