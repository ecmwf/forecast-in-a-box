from forecastbox.settings import FIABSettings
from dataclasses import dataclass


SETTINGS = FIABSettings()
db_name = SETTINGS.mongodb_database

if SETTINGS.mongodb_uri is not None:
    from pymongo import MongoClient

    client = MongoClient(SETTINGS.mongodb_uri)

DATABASES = {}


@dataclass
class DeleteResult:
    """
    Delete result model
    """

    deleted_count: int
    acknowledged: bool = True


class MockMongoDB:
    def __init__(self, db=None, collection=None):
        self.db = db
        self.collection = collection

    def get_database(self, name) -> "MockMongoDB":
        if self.db:
            raise RuntimeError("Database already set")
        if name not in DATABASES:
            DATABASES[name] = {}
        return MockMongoDB(name)

    def __getitem__(self, key) -> "MockMongoDB":
        return self.get_database(key)

    def get_collection(self, collection_name) -> "MockMongoDB":
        if self.collection:
            raise RuntimeError("Collection already set")

        if collection_name not in self.__get_active_database():
            self.__get_active_database()[collection_name] = []

        return MockMongoDB(self.db, collection_name)

    def assert_correct(self):
        assert self.db is not None and self.collection is not None, "Database and collection must be set"

    def __get_active_database(self) -> list:
        assert self.db is not None, "Database must be set"
        return DATABASES[self.db]

    def __get_active_collection(self) -> list:
        self.assert_correct()
        return DATABASES[self.db][self.collection]

    def __len__(self):
        self.assert_correct()
        return len(self.__get_active_collection())

    def insert_one(self, document):
        collection = self.__get_active_collection()
        collection.append(document)
        return {"inserted_id": len(collection) - 1}

    def update_one(self, query, update):
        db = self.__get_active_database()
        if self.collection not in db:
            return {"matched_count": 0, "modified_count": 0}
        for doc in self.__get_active_collection():
            if all(doc.get(k) == v for k, v in query.items()):
                for key, value in update.get("$set", {}).items():
                    doc[key] = value
                return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}

    def find(self, query=None):
        db = self.__get_active_database()
        if self.collection not in db:
            return []
        if not query:
            return self.__get_active_collection()
        return [doc for doc in self.__get_active_collection() if all(doc.get(k) == v for k, v in query.items())]

    def find_one(self, query=None):
        results = self.find(query)
        return results[0] if results else None

    def delete_one(self, query):
        db = self.__get_active_database()
        if self.collection not in db:
            return DeleteResult(0)
        for i, doc in enumerate(self.__get_active_collection()):
            if all(doc.get(k) == v for k, v in query.items()):
                del self.__get_active_collection()[i]
                return DeleteResult(1)
        return DeleteResult(0)

    def delete_many(self, query=None):
        db = self.__get_active_database()
        if self.collection not in db:
            return DeleteResult(0)
        if not query:
            deleted_count = len(self.__get_active_collection())
            db[self.collection] = []
            return DeleteResult(deleted_count)
        initial_count = len(db[self.collection])
        db[self.collection] = [doc for doc in db[self.collection] if not all(doc.get(k) == v for k, v in query.items())]
        deleted_count = initial_count - len(db[self.collection])
        return DeleteResult(deleted_count)


if SETTINGS.mongodb_uri is not None:
    db = client[db_name]
else:
    db = MockMongoDB()[db_name]
