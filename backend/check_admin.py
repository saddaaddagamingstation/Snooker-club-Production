import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import bcrypt
import getpass

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    db = client[os.getenv("DB_NAME")]

    email = "saddaaddagamingstation@gmail.com"

    user = await db.users.find_one({"email": email})

    if not user:
        print("Admin not found")
        return

    print("Admin found:", user["email"])

    password = getpass.getpass("Enter the password you expect to work: ")

    result = bcrypt.checkpw(
        password.encode(),
        user["password_hash"].encode()
    )

    print("Password matches stored hash:", result)

    client.close()

asyncio.run(main())