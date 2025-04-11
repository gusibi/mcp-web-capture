from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    api_key: str = "your_api_key"
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    connect_id: str = "browser-tools"

    class Config:
        env_file = ".env"  # 同时支持系统变量和.env文件

settings = Settings()