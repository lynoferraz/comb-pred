# %% Imports

import networkx as nx
from IPython.display import Image

from pgmpy.models import JunctionTree
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.utils import get_example_model

import importlib

import auto_market_maker

# %% Original model

asia_model = get_example_model('asia')
original_jt = asia_model.to_junction_tree()

pgv_agraph = nx.nx_agraph.to_agraph(original_jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jto_graph.png')
Image('jto_graph.png')

# %% Create model manually

# Manual chest inference
cliques = [ # already moralized and triangulated
    tuple(sorted(["asia","tub"])),
    tuple(sorted(["tub","lung","either"])),
    tuple(sorted(["lung","either","bronc"])),
    tuple(sorted(["bronc","lung","smoke"])),
    tuple(sorted(["either","dysp","bronc"])),
    tuple(sorted(["either","xray"])),
]

edges_indexes = [ # indexes of clique
    (0,1),
    (1,2),
    (2,3),
    (2,4),
    (4,5),
]
edges = []
for edge in edges_indexes:
    edges.append((tuple(cliques[edge[0]]), tuple(cliques[edge[1]])))

jt = JunctionTree()
jt.add_edges_from(edges)

phis = []
jt_vars = set()
for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1] * 2**len(clique)) #,state_names={v: ['no','yes'] for v in clique})
    jt_vars = jt_vars.union(set(clique))
    phis.append(phi)

jt.add_factors(*phis)

report = {'variables': {'either': 1}, 'evidence': {'lung': 1}, 'value': 0.9}
report2 = {'variables': {'lung': 1}, 'value': 0.9}
b = 72
amm_deposit = 1000
user_desposit = 200
user_id = 0

pgv_agraph = nx.nx_agraph.to_agraph(jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jt_graph.png')
Image('jt_graph.png')

# %% Perform operations


importlib.reload(auto_market_maker)
amm = auto_market_maker.PJTAmm()

amm.deposit_amm(amm_deposit)
amm.initialize(jt, b=b)

# print(amm.query(variables=report['variables'],evidence=report.get('evidence')))

amm.deposit_funds(user_id,user_desposit)
# amm.get_edit_bounds(report,user_id)
# amm.get_expected_funds_value(user_id)
# amm.get_edit_cost_delta(report,user_id)

# print(amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=user_id))

amm.perform_edit(report,user_id)

# amm.get_expected_funds_value(user_id)
# amm.get_edit_bounds(report2,user_id)
# amm.get_edit_cost_delta(report2,user_id)

# print(amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=0))

amm.perform_resolve(('either',1))

# amm.get_expected_funds_value(user_id)
# amm.get_edit_bounds(report2,user_id)
# amm.get_edit_cost_delta(report2,user_id)

# print(amm.query(variables=report2['variables'],evidence=report2.get('evidence')))
# print(amm.query(variables=report2['variables'],evidence=report2.get('evidence'),user_id=0))

# amm.perform_add('eeu',2,[['asia'],None])

# map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques = auto_market_maker.get_add_variable_instructions(amm._bp.junction_tree,'eeu',2,[['xray'],['dysp']])
# new_jt, min_value_ = auto_market_maker.resolve_jt(amm._bp.junction_tree, map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques)

pgv_agraph = nx.nx_agraph.to_agraph(amm._bp.junction_tree)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('new_jt_graph.png')
Image('new_jt_graph.png')

# %% More operations
importlib.reload(auto_market_maker)
amm.perform_resolve(('lung',1))
# amm.perform_add('nam',2,[['lung']])
# amm.perform_add('co',2,[['oca'],['cao']])

pgv_agraph = nx.nx_agraph.to_agraph(amm._bp.junction_tree)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('new_jt_graph.png')
Image('new_jt_graph.png')

# %% More operations
# importlib.reload(auto_market_maker)
# auto_market_maker.factor_with_vars(['lung'],amm._bp.junction_tree)

# print(amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=user_id))
print(amm.get_user_jt(user_id).factors[1])

print(amm.get_user_free_funds(user_id))

print(amm.get_expected_funds_value(user_id))
