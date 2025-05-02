from beanie import PydanticObjectId
from fastapi_users import schemas
from beanie import Document
from fastapi_users_db_beanie import BeanieBaseUser


class UserRead(schemas.BaseUser[PydanticObjectId]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


class UserUpdate(schemas.BaseUserUpdate):
    pass


class User(BeanieBaseUser, Document):
    pass
