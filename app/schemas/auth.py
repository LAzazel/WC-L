from pydantic import BaseModel, EmailStr, Field


# Payload accepted by the registration endpoint.
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


# Payload accepted by the login endpoint.
class UserLogin(BaseModel):
    login: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


# Public view of a user returned by the API.
class UserRead(BaseModel):
    id: int
    username: str
    email: EmailStr
    is_admin: bool
    # Banned is the only public account restriction flag now.
    is_banned: bool

    model_config = {"from_attributes": True}


# Standard JWT response returned after successful login.
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Payload for changing the password while authenticated.
class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Payload for changing the public username (login name) while authenticated.
class UserSelfUsername(BaseModel):
    username: str = Field(min_length=3, max_length=50)
