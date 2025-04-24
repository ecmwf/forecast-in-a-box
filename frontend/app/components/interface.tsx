/**
 * Type representing a product category.
 */
export type CategoryType = {
  /**
   * The title of the category.
   */
  title: string;

  /**
   * A brief description of the category.
   */
  description: string;

  /**
   * An array of options available within the category.
   */
  options: string[];

  /**
   * An array of options unavailable within the category.
   */
  unavailable_options: string[];

  /**
   * Availability of the category
   */
  available: boolean;
};

/**
 * Type representing a collection of categories.
 * Each key is a string that maps to a CategoryType object.
 */
export type CategoriesType = {
  [key: string]: CategoryType;
};

export type ConfigEntry = {
  label: string;
  description: string;
  example?: string;
  values?: string[];
  multiple: boolean;
  constrained_by: string[];
  default?: string;
};

export type ProductConfiguration = {
  product: string;
  options: Record<string, ConfigEntry>;
};

export type ModelSpecification = {
  model: string;
  date: Date;
  lead_time: number;
  ensemble_members: number;
  entries?: Record<string, string>;
};

export type ProductSpecification = {
  product: string;
  specification: Record<string, any>;
};

export type EnvironmentSpecification = Record<string, string>;

export type SubmitSpecification = {
  model: ModelSpecification;
  products: ProductSpecification[];
  environment: EnvironmentSpecification;
};


export type DatasetId = string;

export type SubmitResponse = {
  job_id: string;
  error: string;
};



