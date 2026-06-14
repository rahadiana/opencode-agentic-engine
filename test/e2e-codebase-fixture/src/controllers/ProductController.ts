export class ProductController { constructor(private productService: import("../services/ProductService.js").ProductService) {} search(query: string) { return this.productService.search(query) } }
