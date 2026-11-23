from pydantic_settings import BaseSettings, SettingsConfigDict


class FirebaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FIREBASE_", env_file=".env", extra="ignore")
    credentials_json: str | None = None
    service_account: str = "detex.json"


settings = FirebaseSettings()
