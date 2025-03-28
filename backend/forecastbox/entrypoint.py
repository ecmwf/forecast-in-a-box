"""
FastAPI Entrypoint
"""

from fastapi import FastAPI
from .settings import Settings

### Create FastAPI instance with custom docs and openapi url
app = FastAPI(docs_url="/api/py/docs", openapi_url="/api/py/openapi.json")

from .api.routers import models
from .api.routers import products
from .api.routers import graph

app.include_router(models.router, prefix="/api/py/models")
app.include_router(products.router, prefix="/api/py/products")
app.include_router(graph.router, prefix="/api/py/graph")
