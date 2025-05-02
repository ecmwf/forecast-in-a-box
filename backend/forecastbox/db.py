from fastapi_users_db_beanie import BeanieUserDatabase
from forecastbox.settings import FIABSettings
from forecastbox.schemas.user import User

import motor.motor_asyncio
from beanie import init_beanie
from pymongo import MongoClient

SETTINGS = FIABSettings()
db_name = SETTINGS.mongodb_database

user_client = motor.motor_asyncio.AsyncIOMotorClient(SETTINGS.mongodb_uri, uuidRepresentation="standard")
mongo_client = MongoClient(SETTINGS.mongodb_uri)

db = mongo_client[db_name]


async def get_user_db():
    yield BeanieUserDatabase(User)


async def init_db():
    await init_beanie(
        database=user_client[db_name],
        document_models=[
            User,
        ],
    )
