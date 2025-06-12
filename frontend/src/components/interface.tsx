
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

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
  date: string;
  lead_time: number;
  ensemble_members: number;
  entries?: Record<string, string>;
};

export type ProductSpecification = {
  product: string;
  specification: Record<string, any>;
};

export type EnvironmentSpecification = {
  hosts: number;
  workers_per_host: number;
  environment_variables: Record<string, string>;
};

export type EnsembleProducts = {
  job_type: string;
  model: ModelSpecification;
  products: ProductSpecification[];
};

export type ExecutionSpecification = {
  job: EnsembleProducts;
  environment: EnvironmentSpecification;
};


export type DatasetId = string;

export type SubmitResponse = {
  id: string;
  error: string;
};
