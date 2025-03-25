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

export type ConfigSpecification = {
  label: string;
  description: string;
  example?: string;
  values?: string[];
  multiple: boolean;
  constrained_by: string[];
};

export type ProductSpecification = {
  product: string;
  entries: Record<string, ConfigSpecification>;
};

export type ProductConfiguration = {
  product: string;
  options: Record<string, string>;
};
