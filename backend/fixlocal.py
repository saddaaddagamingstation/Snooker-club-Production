
import asyncio
import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    db = client[os.getenv("DB_NAME")]

    result = await db.users.update_one(
        {"email": "Saddaaddagamingstation@gmail.com"},
        {"$set": {"email": "saddaaddagamingstation@gmail.com"}}
    )

    print("Matched:", result.matched_count)
    print("Modified:", result.modified_count)

    client.close()

asyncio.run(main())
