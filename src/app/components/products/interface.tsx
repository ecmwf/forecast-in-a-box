

/**
 * Interface representing a product category.
 */
export interface CategoryInterface {
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
}

/**
 * Interface representing a collection of categories.
 * Each key is a string that maps to a CategoryInterface object.
 */
export interface CategoriesInterface{
    [key: string]: CategoryInterface
}