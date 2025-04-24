# from pymongo import MongoClient

from forecastbox.settings import FIABSettings


SETTINGS = FIABSettings()
db_name = SETTINGS.mongodb_database

if SETTINGS.mongodb_uri is not None:
    from pymongo import MongoClient
    client = MongoClient(SETTINGS.mongodb_uri)


class MockMongoDB:
    _databases = {}

    @staticmethod
    def get_database(name):
        if name not in MockMongoDB._databases:
            MockMongoDB._databases[name] = {}
        return MockMongoDB._databases[name]

    @staticmethod
    def insert_one(collection_name, document):
        db = MockMongoDB.get_database(db_name)
        if collection_name not in db:
            db[collection_name] = []
        db[collection_name].append(document)
        return {"inserted_id": len(db[collection_name]) - 1}

    @staticmethod
    def update_one(collection_name, query, update):
        db = MockMongoDB.get_database(db_name)
        if collection_name not in db:
            return {"matched_count": 0, "modified_count": 0}
        for doc in db[collection_name]:
            if all(doc.get(k) == v for k, v in query.items()):
                for key, value in update.get("$set", {}).items():
                    doc[key] = value
                return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}

    @staticmethod
    def find(collection_name, query=None):
        db = MockMongoDB.get_database(db_name)
        if collection_name not in db:
            return []
        if not query:
            return db[collection_name]
        return [doc for doc in db[collection_name] if all(doc.get(k) == v for k, v in query.items())]

    @staticmethod
    def find_one(collection_name, query=None):
        results = MockMongoDB.find(collection_name, query)
        return results[0] if results else None

    @staticmethod
    def delete_one(collection_name, query):
        db = MockMongoDB.get_database(db_name)
        if collection_name not in db:
            return {"deleted_count": 0}
        for i, doc in enumerate(db[collection_name]):
            if all(doc.get(k) == v for k, v in query.items()):
                del db[collection_name][i]
                return {"deleted_count": 1}
        return {"deleted_count": 0}

    @staticmethod
    def delete_many(collection_name, query=None):
        db = MockMongoDB.get_database(db_name)
        if collection_name not in db:
            return {"deleted_count": 0}
        if not query:
            deleted_count = len(db[collection_name])
            db[collection_name] = []
            return {"deleted_count": deleted_count}
        initial_count = len(db[collection_name])
        db[collection_name] = [doc for doc in db[collection_name] if not all(doc.get(k) == v for k, v in query.items())]
        deleted_count = initial_count - len(db[collection_name])
        return {"deleted_count": deleted_count}

    def __getitem__(self, key) -> dict:
        return self.get_database(db_name).get(key, {})


if SETTINGS.mongodb_uri is not None:
    db = client[db_name]
else:
    db = MockMongoDB()