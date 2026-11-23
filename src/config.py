from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    environment: str = "local" #only dev enviroment can open api doc
    cors_origins: str = "*"
    host: str = "0.0.0.0"
    port: int = 7860


settings = AppSettings()
