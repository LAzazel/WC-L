from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "WC-L"
    debug: bool = False
    secret_key: str = "change-this-secret-key"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    database_url: str = "sqlite:///./wcl.db"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
