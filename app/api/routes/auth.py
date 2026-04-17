from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.models.user import User
from app.db.session import get_db
from app.schemas.auth import (
    PasswordChange,
    Token,
    UserCreate,
    UserLogin,
    UserRead,
    UserSelfUpdate,
)
from app.services.auth import (
    AuthError,
    authenticate_user,
    build_access_token_for_user,
    change_user_password,
    create_user,
    update_self_profile,
)

# Group all authentication-related endpoints under `/auth`.
router = APIRouter(prefix="/auth", tags=["auth"])


# Register a new user and return the public user profile.
@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)) -> UserRead:
    try:
        user = create_user(db, data)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return user


# Validate credentials and return a bearer token.
@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)) -> Token:
    user = authenticate_user(db, data.login, data.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return Token(access_token=build_access_token_for_user(user))


# Return the currently authenticated user resolved from the bearer token.
@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return current_user


# Update the authenticated user's username (display / login name).
@router.patch("/me", response_model=UserRead)
def patch_me(
    data: UserSelfUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    try:
        return update_self_profile(db, current_user, data)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


# Update password for the authenticated user (e.g. profile / admin self-service).
@router.patch("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        change_user_password(db, current_user, data.current_password, data.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
