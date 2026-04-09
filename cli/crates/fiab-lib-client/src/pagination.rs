/// Pagination helper – not used for trait dispatch; kept for future use.
pub struct PaginationParams {
    pub page: u32,
    pub page_size: u32,
}

impl Default for PaginationParams {
    fn default() -> Self {
        Self { page: 1, page_size: 10 }
    }
}
