
import asyncio
import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    db = client[os.getenv("DB_NAME")]

    print("DATABASE:", db.name)
    print("TOTAL USERS:", await db.users.count_documents({}))

    users = await db.users.find(
        {},
        {"_id": 0, "email": 1, "role": 1}
    ).to_list(length=20)

    print("USERS:")
    for user in users:
        print(user)

    client.close()

asyncio.run(main())
