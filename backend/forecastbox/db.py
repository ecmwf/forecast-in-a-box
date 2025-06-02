# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fastapi_users_db_beanie import BeanieUserDatabase
from forecastbox.config import config
from forecastbox.schemas.user import User

from beanie import init_beanie
from pymongo import MongoClient, AsyncMongoClient

db_name = config.db.mongodb_database

async_client = AsyncMongoClient(config.db.mongodb_uri)
mongo_client = MongoClient(config.db.mongodb_uri)

db = mongo_client[db_name]
async_db = async_client[db_name]


async def get_user_db():
    yield BeanieUserDatabase(User)


async def init_db():
    await init_beanie(
        database=async_client[db_name],
        document_models=[
            User,
        ],
    )
