"""strategy evolution runs and run rank

Revision ID: 7c1f4a2e9b3d
Revises: 2ad6b39f0caa
Create Date: 2026-06-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c1f4a2e9b3d'
down_revision: Union[str, Sequence[str], None] = '2ad6b39f0caa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('strategy_runs', sa.Column('rank', sa.Integer(), nullable=False, server_default='0'))
    op.create_table('strategy_evolution_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('triggered_by', sa.String(length=20), nullable=False),
    sa.Column('population_size', sa.Integer(), nullable=False),
    sa.Column('generations', sa.Integer(), nullable=False),
    sa.Column('current_generation', sa.Integer(), nullable=False),
    sa.Column('risk_weight', sa.Float(), nullable=False),
    sa.Column('max_symbols', sa.Integer(), nullable=False),
    sa.Column('fitness_history', sa.JSON(), nullable=False),
    sa.Column('strategy_run_id', sa.Integer(), nullable=True),
    sa.Column('error_message', sa.String(length=1000), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['strategy_run_id'], ['strategy_runs.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_strategy_evolution_runs_status'), 'strategy_evolution_runs', ['status'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_strategy_evolution_runs_status'), table_name='strategy_evolution_runs')
    op.drop_table('strategy_evolution_runs')
    op.drop_column('strategy_runs', 'rank')
