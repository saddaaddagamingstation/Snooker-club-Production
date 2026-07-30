from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import asyncio

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))

    # This actually authenticates
    await client.admin.command("ping")

    print("Connected!")

asyncio.run(main())